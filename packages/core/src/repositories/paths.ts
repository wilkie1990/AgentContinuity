import {
  AgentContinuityError,
  type LocalPathAvailability,
} from "@agent-continuity/contracts";
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

export type CanonicalLocalPath = {
  path: string;
  comparisonKey: string;
};

export type RepositoryPathOptions = {
  /**
   * Linux defaults to case-sensitive comparison; Windows and macOS default to
   * case-insensitive comparison. Callers on a non-default filesystem can override it.
   */
  caseSensitive?: boolean;
};

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function clean(path: string): string {
  const normalized = normalize(path);
  return normalized.length > 1 && normalized.endsWith(sep)
    ? normalized.slice(0, -1)
    : normalized;
}

function isContained(root: string, target: string): boolean {
  const candidate = relative(root, target);
  return candidate === "" || (!candidate.startsWith(`..${sep}`) && candidate !== ".." && !isAbsolute(candidate));
}

/**
 * Owns local path validation for repository identity. It never consults process cwd:
 * every accepted path must already be absolute.
 */
export class RepositoryPathResolver {
  readonly caseSensitive: boolean;

  constructor(options: RepositoryPathOptions = {}) {
    this.caseSensitive =
      options.caseSensitive ?? (process.platform !== "win32" && process.platform !== "darwin");
  }

  comparisonKey(path: string): string {
    const normalized = clean(path);
    return this.caseSensitive ? normalized : normalized.toLocaleLowerCase("en-US");
  }

  relativeComparisonKey(path: string): string {
    return this.caseSensitive ? path : path.toLocaleLowerCase("en-US");
  }

  canonicalDirectory(input: string, label = "repository path"): CanonicalLocalPath {
    if (!isAbsolute(input)) {
      throw new AgentContinuityError(
        "REPOSITORY_PATH_INVALID",
        `${label} must be an absolute local path; process cwd is never used to resolve it.`,
        { path: input },
      );
    }

    try {
      const path = clean(realpathSync.native(input));
      if (!statSync(path).isDirectory()) {
        throw new AgentContinuityError(
          "REPOSITORY_PATH_INVALID",
          `${label} does not identify a directory.`,
          { path: input },
        );
      }
      return { path, comparisonKey: this.comparisonKey(path) };
    } catch (error) {
      if (AgentContinuityError.is(error)) throw error;
      const code = errorCode(error);
      const reason =
        code === "ENOENT" || code === "ENOTDIR"
          ? "does not exist"
          : code === "EACCES" || code === "EPERM"
            ? "is not accessible"
            : "could not be resolved";
      throw new AgentContinuityError(
        "REPOSITORY_PATH_UNAVAILABLE",
        `${label} ${reason}. Check that the path exists and this process can read it.`,
        { path: input, ...(code ? { cause: code } : {}) },
      );
    }
  }

  private canonicalExistingPath(input: string, label: string): CanonicalLocalPath {
    if (!isAbsolute(input)) {
      throw new AgentContinuityError(
        "REPOSITORY_PATH_INVALID",
        `${label} must be absolute.`,
        { path: input },
      );
    }
    try {
      const path = clean(realpathSync.native(input));
      return { path, comparisonKey: this.comparisonKey(path) };
    } catch (error) {
      const code = errorCode(error);
      const reason =
        code === "ENOENT" || code === "ENOTDIR"
          ? "does not exist"
          : code === "EACCES" || code === "EPERM"
            ? "is not accessible"
            : "could not be resolved";
      throw new AgentContinuityError(
        "REPOSITORY_PATH_UNAVAILABLE",
        `${label} ${reason}. Check that the path exists and this process can read it.`,
        { path: input, ...(code ? { cause: code } : {}) },
      );
    }
  }

  availability(path: string): LocalPathAvailability {
    try {
      if (!statSync(path).isDirectory()) {
        return { status: "not_directory", message: "The stored path is no longer a directory." };
      }
      return { status: "available", message: null };
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR") {
        return {
          status: "missing",
          message: "The stored path no longer exists. Update the association to its new location.",
        };
      }
      return {
        status: "inaccessible",
        message: "The stored path cannot be read. Check its permissions and mount availability.",
      };
    }
  }

  relativePath(root: string, target: string): string | null {
    if (!isContained(root, target)) return null;
    const result = relative(root, target);
    return result === "" ? "." : result;
  }

  /**
   * Resolve an existing repository-relative path without permitting lexical or symlink
   * traversal outside the canonical root.
   */
  resolveWithin(root: string, repositoryRelativePath: string): CanonicalLocalPath & {
    relativePath: string;
  } {
    if (!repositoryRelativePath || isAbsolute(repositoryRelativePath)) {
      throw new AgentContinuityError(
        "REPOSITORY_PATH_INVALID",
        "Repository-relative paths must be non-empty and relative.",
        { path: repositoryRelativePath },
      );
    }

    const canonicalRoot = this.canonicalExistingPath(root, "repository root");
    const lexical = resolve(canonicalRoot.path, repositoryRelativePath);
    if (!isContained(canonicalRoot.path, lexical)) {
      throw new AgentContinuityError(
        "REPOSITORY_PATH_INVALID",
        "Repository-relative path traversal outside the associated root is not allowed.",
        { path: repositoryRelativePath },
      );
    }

    const canonical = this.canonicalExistingPath(lexical, "repository-relative path");
    if (!isContained(canonicalRoot.path, canonical.path)) {
      throw new AgentContinuityError(
        "REPOSITORY_PATH_INVALID",
        "The repository-relative path resolves through a symlink outside the associated root.",
        { path: repositoryRelativePath },
      );
    }
    return {
      ...canonical,
      relativePath: this.relativePath(canonicalRoot.path, canonical.path) ?? ".",
    };
  }

  /**
   * Validate a planned repository-relative path. The leaf may not exist yet, but its
   * nearest existing ancestor must resolve inside the explicit worktree root.
   */
  validatePlannedWithin(root: string, repositoryRelativePath: string): void {
    if (!repositoryRelativePath || isAbsolute(repositoryRelativePath)) {
      throw new AgentContinuityError(
        "REPOSITORY_PATH_INVALID",
        "Repository-relative paths must be non-empty and relative.",
        { path: repositoryRelativePath },
      );
    }
    const segments = repositoryRelativePath.split("/");
    if (
      segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
      repositoryRelativePath.includes("\\") ||
      repositoryRelativePath.includes("\0")
    ) {
      throw new AgentContinuityError(
        "REPOSITORY_PATH_INVALID",
        "Repository-relative ownership paths must be normalized without traversal.",
        { path: repositoryRelativePath },
      );
    }

    const canonicalRoot = this.canonicalExistingPath(root, "execution worktree");
    const lexical = resolve(canonicalRoot.path, ...segments);
    if (!isContained(canonicalRoot.path, lexical)) {
      throw new AgentContinuityError(
        "REPOSITORY_PATH_INVALID",
        "Repository-relative path traversal outside the execution worktree is not allowed.",
        { path: repositoryRelativePath },
      );
    }

    let ancestor = lexical;
    while (!existsSync(ancestor) && ancestor !== canonicalRoot.path) {
      ancestor = resolve(ancestor, "..");
    }
    const canonicalAncestor = this.canonicalExistingPath(ancestor, "ownership path ancestor");
    if (!isContained(canonicalRoot.path, canonicalAncestor.path)) {
      throw new AgentContinuityError(
        "REPOSITORY_PATH_INVALID",
        "The ownership path resolves through a symlink outside the execution worktree.",
        { path: repositoryRelativePath },
      );
    }
  }
}
