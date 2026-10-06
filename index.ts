import { NodeServices } from "@effect/platform-node";
import { Plugin } from "@opencode/plugin/effect";
import { Effect, Layer } from "effect";
import { GitLab } from "./src/GitLab.js";

const gitLabLayer = GitLab.layer.pipe(Layer.provide(NodeServices.layer));

export default Plugin.define({
  id: "oc-mr",
  effect: (ctx) =>
    Effect.gen(function* () {
      const gitlab = yield* GitLab;

      yield* ctx.command.transform((editor) => {
        editor.add({
          name: "mr",
          description:
            "Open merge request in a browser. Uses default browser or browser specified in BROWSER variable.",
          execute: Effect.fn("mr.execute")(function* ({ sessionID }) {
            const session = yield* ctx.session.get({ sessionID });
            yield* gitlab.openMR(session.location.directory);
          }),
        });
      });
    }).pipe(Effect.provide(gitLabLayer)),
});
