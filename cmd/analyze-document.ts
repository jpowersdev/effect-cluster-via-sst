#!/usr/bin/env tsx

import { Command, Options } from "@effect/cli"
import { NodeClusterRunnerSocket, NodeContext, NodeRuntime } from "@effect/platform-node"
import { Config, ConfigProvider, Effect, Exit, Layer, pipe } from "effect"
import { TracingLive } from "../src/cluster/tracing"
import { ArchiveError } from "../src/domain/archives"
import { Archivist, ClusterProblem } from "../src/domain/archivist"

const ClusterLayer = NodeClusterRunnerSocket.layer({
  clientOnly: true
})

const archiveUrl = Options.text("url").pipe(
  Options.withDescription("The URL of the archive to process"),
  Options.withFallbackConfig(Config.string("ARCHIVE_URL"))
)

const entrypoint = Command.make("entrypoint", { archiveUrl }).pipe(
  Command.withDescription("Process an archive"),
  Command.withHandler(({ archiveUrl }) =>
    Effect.gen(function*() {
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
            fileCount: result.value.fileCount
          })
        )
      } else {
        yield* Effect.log("Result failed").pipe(
          Effect.annotateLogs({
            cause: result.cause,
            archiveUrl
          })
        )
      }
      return result
    })
  )
)

export const run = Command.run(entrypoint, {
  name: "process-archive",
  version: "0.0.1"
})

run(process.argv).pipe(
  Effect.provide([ClusterLayer, NodeContext.layer, TracingLive]),
  Effect.provide(Layer.setConfigProvider(pipe(
    ConfigProvider.fromJson({
      ZEP_GROUP_ID: "local"
    }),
    ConfigProvider.orElse(() => ConfigProvider.fromEnv())
  ))),
  NodeRuntime.runMain({
    disableErrorReporting: true,
    disablePrettyLogger: true
  })
)
