/** A request the engine refuses, with the HTTP status the route should answer with. */
export class RundownError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
