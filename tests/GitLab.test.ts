import { describe, expect, it } from "@effect/vitest";
import { AbsolutePath } from "@opencode/schema";
import { Effect, Layer, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { CommandFailed, GitLab, MergeRequestNotFound } from "../src/GitLab.js";

const completedProcess = (stdout: string, stdErr = "", exitCode = 0) => {
  const output = Stream.succeed(new TextEncoder().encode(stdout));
  const errors = Stream.succeed(new TextEncoder().encode(stdErr));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    stdout: output,
    stderr: errors,
    all: Stream.concat(output, errors),
    stdin: Sink.drain,
    kill: () => Effect.void,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
};

const setup = (responses: Array<ChildProcessSpawner.ChildProcessHandle>) => {
  const cwd = AbsolutePath.make("/projects/repo");
  const commands: Array<ChildProcess.StandardCommand> = [];
  const pending = [...responses];
  const fakeSpawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      if (!ChildProcess.isStandardCommand(command)) {
        throw new Error("Unexpected command");
      }

      commands.push(command);
      const response = pending.shift();
      if (response === undefined) {
        throw new Error("Unexpected additional command");
      }

      return response;
    }),
  );

  const testLayer = GitLab.layer.pipe(
    Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, fakeSpawner)),
  );
  return { cwd, commands, testLayer };
};

describe("GitLab", () => {
  it.each(["", " \n "])(
    "provides a command failure message when stderr is blank (%j)",
    (stderr) => {
      const error = new CommandFailed({
        summary: "Can't determine the current branch",
        command: "git symbolic-ref --short HEAD",
        exitCode: 128,
        stderr,
      });

      expect(error.message).toBe(
        "Can't determine the current branch:\nCommand exited with code 128.",
      );
    },
  );

  it.effect("opens the latest MR for the current branch", () => {
    const { cwd, commands, testLayer } = setup([
      completedProcess("feature/example\n"),
      completedProcess('[{"iid": 123}]'),
      completedProcess(""),
    ]);

    return Effect.gen(function* () {
      const gitlab = yield* GitLab;
      yield* gitlab.openMR(cwd);

      expect(
        commands.map((c) => ({
          executable: c.command,
          args: c.args,
          cwd: c.options?.cwd,
        })),
      ).toEqual([
        { executable: "git", args: ["symbolic-ref", "--short", "HEAD"], cwd },

        {
          executable: "glab",
          args: [
            "mr",
            "list",
            "--source-branch",
            "feature/example",
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
          cwd,
        },
        { executable: "glab", args: ["mr", "view", "123", "--web"], cwd },
      ]);
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("reports no matching MR without opening a browser", () => {
    const { cwd, commands, testLayer } = setup([
      completedProcess("feature/example\n"),
      completedProcess("[]"),
    ]);

    return Effect.gen(function* () {
      const gitlab = yield* GitLab;
      const error = yield* gitlab.openMR(cwd).pipe(Effect.flip);

      expect(error).toBeInstanceOf(MergeRequestNotFound);
      expect(error).toMatchObject({ branch: "feature/example" });
      expect(error.message).toBe('No merge request found for branch "feature/example".');
      expect(commands).toHaveLength(2);
    }).pipe(Effect.provide(testLayer));
  });

  it.effect.each([
    {
      stage: "branch lookup",
      responses: () => [completedProcess("", "fatal: not a git repository\n", 128)],
      command: "git symbolic-ref --short HEAD",
      exitCode: 128,
      stderr: "fatal: not a git repository",
      message: "Can't determine the current branch:\nfatal: not a git repository",
      count: 1,
    },
    {
      stage: "MR listing",
      responses: () => [
        completedProcess("feature/example\n"),
        completedProcess("", "authentication failed\n", 1),
      ],
      command:
        "glab mr list --source-branch feature/example --all --order created_at --sort desc --per-page 1 --output json",
      exitCode: 1,
      stderr: "authentication failed",
      message: `Can't find a merge request for branch "feature/example":\nauthentication failed`,
      count: 2,
    },
    {
      stage: "browser opening",
      responses: () => [
        completedProcess("feature/example\n"),
        completedProcess('[{"iid":123}]'),
        completedProcess("", "browser unavailable\n", 1),
      ],
      command: "glab mr view 123 --web",
      exitCode: 1,
      stderr: "browser unavailable",
      message: "Found merge request !123, but couldn't open it in a browser:\nbrowser unavailable",
      count: 3,
    },
  ])("reports failure during $stage and stops executing commands", (testCase) => {
    const { cwd, commands, testLayer } = setup(testCase.responses());

    return Effect.gen(function* () {
      const gitlab = yield* GitLab;
      const error = yield* gitlab.openMR(cwd).pipe(Effect.flip);

      expect(error).toBeInstanceOf(CommandFailed);
      expect(error).toMatchObject({
        command: testCase.command,
        exitCode: testCase.exitCode,
        stderr: testCase.stderr,
      });
      expect(error.message).toBe(testCase.message);
      expect(commands).toHaveLength(testCase.count);
    }).pipe(Effect.provide(testLayer));
  });

  it.effect.each([
    { description: "malformed JSON", stdout: "not JSON" },
    { description: "invalid IID", stdout: '[{"iid":"123"}]' },
  ])("rejects $description without opening a browser", ({ stdout }) => {
    const { cwd, commands, testLayer } = setup([
      completedProcess("feature/example\n"),
      completedProcess(stdout),
    ]);

    return Effect.gen(function* () {
      const gitlab = yield* GitLab;
      const error = yield* gitlab.openMR(cwd).pipe(Effect.flip);

      expect(error).toMatchObject({ _tag: "SchemaError" });
      expect(commands).toHaveLength(2);
    }).pipe(Effect.provide(testLayer));
  });
});
