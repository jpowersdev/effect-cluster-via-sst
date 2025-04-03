import { RunnerAddress } from "@effect/cluster"
import { NodeClusterRunnerSocket, NodeRuntime } from "@effect/platform-node"
import { IpAddress, ipLayer, Port, portLayer } from "app/cluster/container-metadata"
import { HealthServerLive } from "app/cluster/health-server"
import { SqlLayer } from "app/cluster/sql"
import { Context, Effect, Layer, Logger, Option } from "effect"
import { LibrarianLive } from "./domain/librarian"

const RunnerLive = Layer.mergeAll(ipLayer, portLayer).pipe(
  Layer.flatMap((ctx) =>
    NodeClusterRunnerSocket.layer({
      storage: "sql",
      shardingConfig: {
        runnerAddress: Option.some(
          RunnerAddress.make(
            Context.get(ctx, IpAddress),
            Context.get(ctx, Port)
          )
        )
      }
    })
  )
)

const Entities = Layer.mergeAll(LibrarianLive).pipe(
  Layer.provide(ipLayer)
)

const program = Entities.pipe(
  Layer.provide(RunnerLive),
  Layer.provide(HealthServerLive),
  Layer.provide(SqlLayer),
  Layer.launch
)

const inEcs = process.env.ECS_CONTAINER_METADATA_URI_V4 !== undefined
const programWithAdjustedLogger = inEcs
  ? program.pipe(Effect.provide(Logger.json))
  : program

programWithAdjustedLogger.pipe(
  NodeRuntime.runMain({ disablePrettyLogger: inEcs })
)
