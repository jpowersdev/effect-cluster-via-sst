import { ZepClient } from "@getzep/zep-cloud"
import { Config, Effect, Schema } from "effect"

export class ZepError extends Schema.TaggedError<ZepError>()("ZepError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

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

    return {
      client,
      groupId,
      with: with_
    } as const
  })
}) {
}
