import { CompilerRegistry } from "../core/registry";
import { AddmusicKCompiler } from "./addmusick";

/**
 * The one place that knows which compilers exist.
 *
 * To add "Addmusic 5": implement `MmlCompiler` under `src/compilers/am5/`,
 * import it here, and add one `.register(...)` line. Nothing else changes.
 */
export const compilers = new CompilerRegistry().register(new AddmusicKCompiler());
