import { AiError } from "@effect/ai"
import { ClusterSchema, Entity } from "@effect/cluster"
import { Rpc } from "@effect/rpc"
import { Effect, Layer, Schema } from "effect"
import { ZepError } from "../cluster/zep"
import { DocumentProcessor } from "./document-processor"

export class ClusterProblem extends Schema.TaggedError<ClusterProblem>(
  "ClusterProblem"
)("ClusterProblem", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

export const Librarian = Entity.make("Librarian", [
  Rpc.make("AnalyzeDocument", {
    payload: {
      document: Schema.String
    },
    success: Schema.Struct({
      analysis: Schema.String
    }),
    error: Schema.Union(
      AiError.AiError,
      ZepError
    )
  })
]).annotateRpcs(ClusterSchema.Persisted, true)

export const LibrarianLive = Librarian.toLayer(
  Effect.gen(function*() {
    const address = yield* Entity.CurrentAddress
    const processor = yield* DocumentProcessor

    return {
      AnalyzeDocument: Effect.fnUntraced(
        function*(envelope) {
          const analysis = yield* processor.processDocument(envelope.payload.document)
          return {
            analysis
          }
        },
        (effect) =>
          Effect.annotateLogs(effect, {
            address,
            pid: process.pid
          })
      )
    }
  })
).pipe(Layer.provide(DocumentProcessor.Default))
