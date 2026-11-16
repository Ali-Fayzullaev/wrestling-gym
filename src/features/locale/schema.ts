import { z } from "zod";

import { LOCALES } from "@/lib/locale";

export const localeSchema = z.enum(LOCALES);
