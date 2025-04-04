import { NodeClusterShardManagerSocket, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Logger } from "effect"
import { SqlLayer } from "./cluster/sql"
import { TracingLive } from "./cluster/tracing"

const inEcs = process.env.ECS_CONTAINER_METADATA_URI_V4 !== undefined

const program = NodeClusterShardManagerSocket.layer({ storage: "sql" }).pipe(
  Layer.provide(SqlLayer),
  Layer.provide(TracingLive),
  Layer.launch
)

const programWithAdjustedLogger = inEcs
  ? program.pipe(Effect.provide(Logger.json))
  : program

programWithAdjustedLogger.pipe(
  NodeRuntime.runMain({ disablePrettyLogger: inEcs })
)
