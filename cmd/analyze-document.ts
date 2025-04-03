#!/usr/bin/env tsx

import { AiError } from "@effect/ai"
import { NodeClusterRunnerSocket } from "@effect/platform-node"
import { ConfigProvider, Duration, Effect, Exit, Layer } from "effect"
import { ZepError } from "../src/cluster/zep"
import { ClusterProblem, Librarian } from "../src/domain/librarian"
import { TracingLive } from "../src/tracing"

const getNodeId = () => `node-${Math.floor(Math.random() * 1000)}`

const program = Effect.gen(function*() {
  const client = yield* Librarian.client

  const nodeId = getNodeId()
  const document = "test"

  const result = yield* Effect.log(
    `Analyze document ${nodeId}: '${document}'`
  ).pipe(
    Effect.zipRight(
      client(nodeId).AnalyzeDocument({ document }).pipe(Effect.exit)
    ),
    Effect.flatMap((exit) => {
      // no mathematician will calculate such a large number
      // avoid retrying
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        if (exit.cause.error instanceof ZepError) {
          return Exit.succeed({
            message: "Librarian failed to upload analysis to Zep",
            analysis: "",
            result: exit.cause.error.message
          })
        }
        if (exit.cause.error instanceof AiError.AiError) {
          return Exit.succeed({
            message: "Librarian failed to analyze document",
            analysis: "",
            result: exit.cause.error.message
          })
        }
        // all other error could be recoverable
        return Effect.fail(exit.cause.error)
      }
      return exit
    }),
    Effect.withSpan("analyze-document"),
    Effect.timeout(Duration.seconds(3)),
    Effect.retry({
      times: 0
    }),
    // Something catastrophic happened
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
        analysis: result.value.analysis,
        document
      })
    )
  } else {
    yield* Effect.log("Result failed").pipe(
      Effect.annotateLogs({ cause: result.cause, document })
    )
  }
  return result
})

const ClusterLayer = NodeClusterRunnerSocket.layer({
  clientOnly: true
})

Effect.all(Effect.replicate(program, 30), { concurrency: 15 })
  .pipe(
    Effect.tap((results) => {
      const success = results.filter(Exit.isSuccess).length
      const failure = results.filter(Exit.isFailure).length
      console.log(`Success: ${success}, Failure: ${failure}`)
    }),
    Effect.provide(ClusterLayer),
    Effect.provide(Layer.setConfigProvider(ConfigProvider.fromJson({
      ZEP_GROUP_ID: "local"
    }))),
    Effect.provide(TracingLive),
    Effect.catchAll((error) => {
      console.error(error)
      return Effect.void
    }),
    Effect.runPromise
  )
  .catch((error) => {
    console.error(error)
  })
