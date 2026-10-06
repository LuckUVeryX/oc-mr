import type { AbsolutePath } from "@opencode/schema";
import { Context, Data, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const MergeRequestsJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      iid: Schema.Int,
    }),
  ),
);

export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly summary: string;
  readonly command: string;
  readonly exitCode: number;
  readonly stderr: string;
}> {
  override get message() {
    const detail = this.stderr.trim() || `Command exited with code ${this.exitCode}.`;
    return `${this.summary}:\n${detail}`;
  }
}

export class MergeRequestNotFound extends Data.TaggedError("MergeRequestNotFound")<{
  readonly branch: string;
}> {
  override get message() {
    return `No merge request found for branch "${this.branch}".`;
  }
}

export class GitLab extends Context.Service<GitLab>()("oc-mr/GitLab", {
  make: Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const getBranch = Effect.fn("GitLab.getBranch")(function* (cwd: AbsolutePath) {
      const handle = yield* spawner.spawn(
        ChildProcess.make("git", ["symbolic-ref", "--short", "HEAD"], { cwd }),
      );

      const [exitCode, stdout, stderr] = yield* Effect.all(
        [
          handle.exitCode,
          handle.stdout.pipe(Stream.decodeText, Stream.mkString),
          handle.stderr.pipe(Stream.decodeText, Stream.mkString),
        ],
        { concurrency: "unbounded" },
      );

      if (exitCode !== 0) {
        return yield* new CommandFailed({
          summary: "Can't determine the current branch",
          command: "git symbolic-ref --short HEAD",
          stderr: stderr.trim(),
          exitCode,
        });
      }

      return stdout.trim();
    }, Effect.scoped);

    const getLatestMR = Effect.fn("GitLab.getLatestMR")(function* (
      cwd: AbsolutePath,
      branch: string,
    ) {
      const handle = yield* spawner.spawn(
        ChildProcess.make(
          "glab",
          [
            "mr",
            "list",
            "--source-branch",
            branch,
            "--all",
            "--order",
            "created_at",
            "--sort",
            "desc",
            "--per-page",
            "1",
            "--output",
            "json",
          ],
          { cwd },
        ),
      );

      const [exitCode, stdout, stderr] = yield* Effect.all(
        [
          handle.exitCode,
          handle.stdout.pipe(Stream.decodeText, Stream.mkString),
          handle.stderr.pipe(Stream.decodeText, Stream.mkString),
        ],
        { concurrency: "unbounded" },
      );

      if (exitCode !== 0) {
        return yield* new CommandFailed({
          summary: `Can't find a merge request for branch "${branch}"`,
          command:
            "glab mr list --source-branch " +
            branch +
            " --all --order created_at --sort desc --per-page 1 --output json",
          stderr: stderr.trim(),
          exitCode,
        });
      }

      const mergeRequests = yield* Schema.decodeEffect(MergeRequestsJson)(stdout);
      const mr = mergeRequests[0];
      if (mr === undefined) {
        return yield* new MergeRequestNotFound({ branch });
      }

      return mr.iid;
    }, Effect.scoped);

    const openMR = Effect.fn("GitLab.openMR")(function* (cwd: AbsolutePath) {
      const branch = yield* getBranch(cwd);
      const iid = yield* getLatestMR(cwd, branch);

      const handle = yield* spawner.spawn(
        ChildProcess.make("glab", ["mr", "view", String(iid), "--web"], { cwd }),
      );
      const [exitCode, _, stderr] = yield* Effect.all(
        [
          handle.exitCode,
          handle.stdout.pipe(Stream.decodeText, Stream.mkString),
          handle.stderr.pipe(Stream.decodeText, Stream.mkString),
        ],
        { concurrency: "unbounded" },
      );

      if (exitCode !== 0) {
        return yield* new CommandFailed({
          summary: `Found merge request !${iid}, but couldn't open it in a browser`,
          command: `glab mr view ${iid} --web`,
          stderr: stderr.trim(),
          exitCode,
        });
      }
    }, Effect.scoped);

    return { openMR };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
