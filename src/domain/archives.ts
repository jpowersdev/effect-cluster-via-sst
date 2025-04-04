import { Command, CommandExecutor, FileSystem } from "@effect/platform"
import { NodeCommandExecutor, NodeFileSystem } from "@effect/platform-node"
import { Effect, identity, Layer, Match, Option, pipe, Schema, Stream } from "effect"

export class ArchiveError extends Schema.TaggedError<ArchiveError>()("ArchiveError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

export class Archives extends Effect.Service<Archives>()("Archives", {
  dependencies: [
    pipe(
      NodeCommandExecutor.layer,
      Layer.provideMerge(NodeFileSystem.layer)
    )
  ],
  scoped: Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const exec = yield* CommandExecutor.CommandExecutor

    const dir = yield* fs.makeTempDirectoryScoped()

    const extractArchive = Effect.fn("Archives.extractArchive")(
      function*(archiveUrl: string) {
        const archiveFile = dir + "/" + archiveUrl.split("/").pop()
        const archiveDir = archiveFile.split(".").slice(0, -1).join(".")

        yield* Effect.log("Downloading archive").pipe(
          Effect.annotateLogs({
            archiveUrl,
            archiveFile
          })
        )

        yield* exec.string(Command.make("wget", archiveUrl, "-O", archiveFile))

        yield* Effect.log("Unzipping archive").pipe(
          Effect.annotateLogs({
            archiveFile,
            archiveDir
          })
        )

        yield* Match.value(archiveFile.split(".").pop()).pipe(
          Match.when("zip", () =>
            Effect.gen(function*() {
              yield* exec.string(Command.make("unzip", archiveFile, "-d", archiveDir))
            })),
          Match.when("tar.gz", () =>
            Effect.gen(function*() {
              yield* exec.string(Command.make("tar", "-xvf", archiveFile, "-C", archiveDir))
            })),
          Match.orElse(() =>
            new ArchiveError({
              message: "Unsupported archive format",
              cause: `Unknown archive extension: ${archiveFile.split(".").pop()}`
            })
          )
        )

        return archiveDir
      },
      Effect.mapError((cause) => new ArchiveError({ message: "Failed to extract archive", cause }))
    )

    const collectFiles = Effect.fn("Archives.collectFiles")(
      function*(archiveDir: string) {
        yield* Effect.log("Collecting files").pipe(
          Effect.annotateLogs({
            archiveDir
          })
        )

        const files = yield* fs.readDirectory(archiveDir, { recursive: true }).pipe(
          Effect.tapErrorCause(Effect.logError)
        )

        yield* Effect.log("Filtering non-files").pipe(
          Effect.annotateLogs({
            fileCount: files.length
          })
        )

        return yield* Stream.fromIterable(files).pipe(
          Stream.mapEffect(
            Effect.fnUntraced(function*(fileName: string) {
              const filePath = archiveDir + "/" + fileName

              yield* Effect.log("Validating file").pipe(
                Effect.annotateLogs({
                  fileName,
                  filePath
                })
              )

              const stat = yield* fs.stat(filePath)
              if (stat.type !== "File") return Option.none()

              yield* Effect.log("Analyzing file").pipe(
                Effect.annotateLogs({
                  filePath
                })
              )

              const content = yield* fs.readFileString(filePath)

              return Option.some({
                name: fileName,
                content
              })
            }),
            {
              concurrency: "unbounded"
            }
          ),
          Stream.filterMap(identity),
          Stream.runCollect
        )
      },
      Effect.mapError((cause) => new ArchiveError({ message: "Failed to collect files", cause }))
    )

    return {
      extractArchive,
      collectFiles
    } as const
  })
}) {}
