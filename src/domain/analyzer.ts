import { AiInput, AiRole, Completions, Tokenizer } from "@effect/ai"
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

    const analyzeDocument = (
      document: AiInput.AiInput
    ) =>
      pipe(
        tokenizer.truncate(
          Chunk.appendAll(
            AiInput.make({
              role: AiRole.userWithName("document-provider"),
              content: document
            }),
            AiInput.make(
              [
                "Please describe the content and purpose of the above document in 3-5 sentences.",
                "Limit your response to information that is explicitly stated in the document.",
                "Use markdown, and include samples where appropriate."
              ].join(" ")
            )
          ),
          30_000
        ),
        Effect.flatMap(completions.create),
        AiInput.provideSystem(
          `You are a helpful assistant that can answer questions and help with tasks. You are limited in resources, so you need to be efficient and concise.
        
You are given a document followed by a question. You need to answer the question based on the document.`
        ),
        Effect.map((_) => _.text)
      )

    return {
      analyzeDocument
    } as const
  })
}) {}
