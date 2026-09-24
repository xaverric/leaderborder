export class LeaderborderError extends Error {
  constructor(code, message, { cause, status, reason } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LeaderborderError";
    this.code = code;
    if (status !== undefined) this.status = status;
    if (reason !== undefined) this.reason = reason;
  }
}
