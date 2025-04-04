import { AiError } from "@effect/ai"
import { ClusterSchema, Entity } from "@effect/cluster"
import { Rpc } from "@effect/rpc"
import { Duration, Effect, Layer, Schedule, Schema } from "effect"
import { DocumentAnalyzer } from "./analyzer"
import { ArchiveError, Archives } from "./archives"
import { Zep, ZepError } from "./zep"

export class ClusterProblem extends Schema.TaggedError<ClusterProblem>(
  "ClusterProblem"
)("ClusterProblem", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

export const Archivist = Entity.make("Archivist", [
  Rpc.make("AnalyzeDocument", {
    payload: {
      name: Schema.String,
      content: Schema.String
    },
    success: Schema.Struct({
      analysis: Schema.String
    }),
    error: Schema.Union(
      AiError.AiError,
      ZepError
    )
  }),
  Rpc.make("PrepareDocuments", {
    payload: {
      archiveUrl: Schema.String
    },
    success: Schema.Struct({
      fileCount: Schema.Number
    }),
    error: Schema.Union(
      ArchiveError,
      ClusterProblem
    )
  })
]).annotateRpcs(ClusterSchema.Persisted, true)

export const ArchivistLive = Archivist.toLayer(
  Effect.gen(function*() {
    const address = yield* Entity.CurrentAddress
    const archives = yield* Archives
    const analyzer = yield* DocumentAnalyzer
    const zep = yield* Zep

    const client = yield* Archivist.client

    return {
      PrepareDocuments: Effect.fn("Archivist.PrepareDocuments")(
        function*(envelope) {
          const archiveDir = yield* archives.extractArchive(envelope.payload.archiveUrl)
          const files = yield* archives.collectFiles(archiveDir)

          yield* Effect.forEach(
            files,
            (file) =>
              client(file.name).AnalyzeDocument({
                name: file.name,
                content: file.content
              }).pipe(
                Effect.retry({
                  times: 3,
                  schedule: Schedule.exponential(Duration.seconds(1))
                }),
                // Something catastrophic happened
                Effect.catchAll((e) =>
                  Effect.fail(
                    new ClusterProblem({
                      message: "Something catastrophic happened -> " + e._tag
                    })
                  )
                )
              ),
            { concurrency: "inherit" }
          )

          return {
            fileCount: files.length
          }
        },
        (effect) =>
          effect.pipe(
            Effect.annotateLogs({
              address,
              pid: process.pid
            }),
            Effect.scoped
          )
      ),
      AnalyzeDocument: Effect.fn("Archivist.AnalyzeDocument")(
        function*(envelope) {
          yield* Effect.annotateCurrentSpan({
            fileName: envelope.payload.name
          })

          yield* Effect.log("Analyzing document").pipe(
            Effect.annotateLogs({
              fileName: envelope.payload.name
            })
          )

          const analysis = yield* analyzer.analyzeDocument(
            envelope.payload
          )

          yield* Effect.log("Updating knowledge graph").pipe(
            Effect.annotateLogs({
              fileName: envelope.payload.name,
              analysis
            })
          )

          const data = JSON.stringify({
            name: envelope.payload.name,
            content: envelope.payload.content,
            analysis
          })

          yield* zep.addData(data).pipe(
            Effect.tap((_) =>
              Effect.log("Uploaded").pipe(
                Effect.annotateLogs({
                  "document.name": envelope.payload.name,
                  "node.name": _.name,
                  "node.content": _.content,
                  "node.createdAt": _.createdAt
                })
              )
            ),
            Effect.catchTag("TooLargeError", () =>
              Effect.logWarning("Skipping too large document").pipe(
                Effect.annotateLogs({
                  "document.name": envelope.payload.name
                })
              ))
          )

          yield* Effect.log("Completed analysis").pipe(
            Effect.annotateLogs({
              fileName: envelope.payload.name,
              analysis
            })
          )

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
    } as const
  })
).pipe(Layer.provide([
  Archives.Default,
  DocumentAnalyzer.Default,
  Zep.Default
]))
