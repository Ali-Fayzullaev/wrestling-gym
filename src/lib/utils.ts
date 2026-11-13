import { createCn } from "cn/engine";

import tables from "./cn-tables";

/** Tailwind class merging with tables generated for this project (see cn.build.ts). */
export const cn = createCn(tables);
