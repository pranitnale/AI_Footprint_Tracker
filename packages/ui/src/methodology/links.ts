/** Where the parts live: the extension and the website each have their own addresses. */
export interface MethodologyLinks {
  part1: string;
  part2: string;
  reference: string;
  /** The tracker's public source repository. Callers read it from config/source-repository.json. */
  repository: string;
}
