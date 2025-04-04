import { NodeClusterRunnerSocket } from "@effect/platform-node"
import { Archivist, ClusterProblem } from "app/domain/archivist"
import type { LambdaFunctionURLHandlerWithIAMAuthorizer } from "aws-lambda"
import { Effect, Exit, Schema } from "effect"
import { ArchiveError } from "../domain/archives"

const processArchive = Effect.fn("processArchive")(
  function*(archiveUrl: string) {
    const client = yield* Archivist.client

    const result = yield* Effect.log(`Processing archive`).pipe(
      Effect.annotateLogs({ archiveUrl }),
      Effect.zipRight(
        client(archiveUrl).PrepareDocuments({ archiveUrl }).pipe(Effect.exit)
      ),
      Effect.flatMap((exit) => {
        // avoid retrying
        if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
          if (exit.cause.error instanceof ArchiveError) {
            return Exit.succeed({
              message: "Archivist failed to prepare documents",
              fileCount: 0,
              result: exit.cause.error.message
            })
          }
          // all other error could be recoverable
          return Effect.fail(exit.cause.error)
        }
        return exit
      }),
      Effect.catchAll((e) =>
        Effect.fail(
          new ClusterProblem({
            message: "Something catastrophic happened -> " + e._tag
          })
        )
      ),
      Effect.exit
    )

    if (Exit.isSuccess(result)) {
      yield* Effect.log("Result").pipe(
        Effect.annotateLogs({
          archiveUrl,
          fileCount: result.value.fileCount
        })
      )
    } else {
      yield* Effect.log("Result failed").pipe(
        Effect.annotateLogs({ cause: result.cause, archiveUrl })
      )
    }
    return result
  }
)

const LambdaClusterLayer = NodeClusterRunnerSocket.layer({
  clientOnly: true
})

const LambdaRequest = Schema.Struct({
  archiveUrl: Schema.URL
})

export const handler: LambdaFunctionURLHandlerWithIAMAuthorizer = async (e) => {
  const startTime = Date.now()

  await Effect.gen(function*() {
    const request = yield* Schema.decodeUnknown(LambdaRequest)(e.body)
    return yield* processArchive(request.archiveUrl.toString())
  }).pipe(Effect.provide(LambdaClusterLayer), Effect.runPromise)

  const endTime = Date.now()
  const elapsedTime = endTime - startTime

  return {
    statusCode: 200,
    body: "Lambda processed " +
      "elapsed time: " +
      (elapsedTime / 1000).toFixed(2) +
      "s"
  }
}
