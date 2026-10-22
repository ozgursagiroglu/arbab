export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  status: CheckStatus;
  check: string;
  detail: string;
}
