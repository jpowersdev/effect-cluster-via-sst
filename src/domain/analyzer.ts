import { AiInput, Completions, Tokenizer } from "@effect/ai"
import { OpenAiClient, OpenAiCompletions } from "@effect/ai-openai"
import { HttpClient } from "@effect/platform"
import { NodeHttpClient } from "@effect/platform-node"
import { Chunk, Config, Effect, Layer, pipe, Schedule } from "effect"

export const OpenAiLive = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
  organizationId: Config.redacted("OPENAI_ORGANIZATION").pipe(
    Config.withDefault(undefined)
  ),
  transformClient: Config.succeed(
    HttpClient.retryTransient({
      times: 3,
      schedule: Schedule.exponential(500)
    })
  )
}).pipe(Layer.provide(NodeHttpClient.layerUndici))

export const CompletionsLive = OpenAiCompletions.layer({
  model: "gpt-4o-mini"
}).pipe(Layer.provide(OpenAiLive))

export class DocumentAnalyzer extends Effect.Service<DocumentAnalyzer>()("DocumentAnalyzer", {
  dependencies: [CompletionsLive],
  scoped: Effect.gen(function*() {
    const completions = yield* Completions.Completions
    const tokenizer = yield* Tokenizer.Tokenizer

    const analyzeDocument = Effect.fn("DocumentAnalyzer.analyzeDocument")(
      function*(params: { name: string; content: string }) {
        yield* Effect.annotateCurrentSpan({
          documentName: params.name
        })

        return yield* pipe(
          tokenizer.truncate(
            Chunk.appendAll(
              AiInput.make(params.content),
              AiInput.make(
                [
                  `Everything above is a document named '${params.name}'.`,
                  `Please describe the content and purpose of the document in 3-5 sentences.`,
                  "Limit your response to information that is explicitly stated in the document.",
                  "Use markdown, and include samples where appropriate."
                ].join("\n")
              )
            ),
            30_000
          ),
          Effect.flatMap(completions.create),
          AiInput.provideSystem(
            [
              `You are a helpful assistant that can answer questions and help with tasks.`,
              `You are limited in resources, so you need to be efficient and concise.`
            ].join("\n")
          ),
          Effect.map((_) => _.text)
        )
      }
    )

    return {
      analyzeDocument
    } as const
  })
}) {}
