import { AiInput } from "@effect/ai"
import { Effect } from "effect"
import { Zep } from "../cluster/zep"
import { DocumentAnalyzer } from "./analyzer"

export class DocumentProcessor extends Effect.Service<DocumentProcessor>()("DocumentProcessor", {
  dependencies: [DocumentAnalyzer.Default, Zep.Default],
  scoped: Effect.gen(function*() {
    const analyzer = yield* DocumentAnalyzer
    const graph = yield* Zep

    const processDocument = (document: string) =>
      Effect.gen(function*() {
        const analysis = yield* analyzer.analyzeDocument(AiInput.make(document))
        const json = JSON.stringify({
          document,
          analysis
        })

        yield* graph.with((client) =>
          client.graph.add({
            groupId: graph.groupId,
            type: "json",
            data: json
          })
        )

        return analysis
      })

    return {
      processDocument
    } as const
  })
}) {}
