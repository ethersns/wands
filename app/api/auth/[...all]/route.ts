import { toNextJsHandler } from "better-auth/next-js";
import { memberAuth } from "@/lib/auth/member";

export const { GET, POST } = toNextJsHandler(memberAuth);
