import { ZepClient } from "@getzep/zep-cloud"
import { Config, Duration, Effect, Schedule, Schema } from "effect"

export class ZepError extends Schema.TaggedError<ZepError>()("ZepError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

export class TooLargeError extends Schema.TaggedError<TooLargeError>()(
  "TooLargeError",
  {
    message: Schema.String
  }
) {}

export class Zep extends Effect.Service<Zep>()("Zep", {
  effect: Effect.gen(function*() {
    const { apiKey, groupId } = yield* Config.all({
      apiKey: Config.string("ZEP_API_KEY"),
      groupId: Config.string("ZEP_GROUP_ID").pipe(
        Config.withDefault("default")
      )
    })

    const client = new ZepClient({ apiKey })

    const with_ = <A>(fn: (client: ZepClient) => Promise<A>) =>
      Effect.tryPromise({
        try: () => fn(client),
        catch: (error) =>
          new ZepError({
            message: "Failed to call Zep",
            cause: error
          })
      })

    yield* with_((client) => client.group.getGroup(groupId)).pipe(
      Effect.orElse(() => with_((client) => client.group.add({ groupId })))
    )

    const addData = Effect.fn("Zep.addData")(function*(data: string) {
      if (data.length > 10000) {
        return yield* new TooLargeError({
          message: "Data is too large"
        })
      }

      return yield* with_((client) =>
        client.graph.add({
          groupId,
          type: "json",
          data
        })
      ).pipe(
        Effect.tapErrorCause(Effect.logError),
        Effect.retry({
          times: 3,
          schedule: Schedule.exponential(Duration.seconds(1))
        })
      )
    })

    return {
      client,
      groupId,
      with: with_,
      addData
    } as const
  })
}) {
}
