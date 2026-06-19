export const USERS = ["user-a", "user-b"] as const;
export type UserId = (typeof USERS)[number];
