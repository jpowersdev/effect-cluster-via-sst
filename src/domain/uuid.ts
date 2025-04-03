import { Effect } from "effect"
import { v4 as uuidv4 } from "uuid"

export class Uuid extends Effect.Service<Uuid>()("Uuid", {
  accessors: true,
  succeed: {
    v4: () => uuidv4()
  }
}) {}
