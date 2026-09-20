import { MIME_REGISTRY, MIME_TAIL } from "./mime-registry";
import { MIME_CHUNK_2 } from "./mime-registry-2";
import type { MimeRecord } from "@/lib/types";

/** Combined MIME registry: base registry, verified chunk 2, and the alias tail. */
export const MIME_REGISTRY_ALL: MimeRecord[] = [...MIME_REGISTRY, ...MIME_CHUNK_2, ...MIME_TAIL];
