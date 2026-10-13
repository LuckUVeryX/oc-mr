# oc-mr

An [OpenCode V2](https://opencode.ai/v2/docs/) plugin that opens the latest
**GitLab merge request** for the current branch with `/mr`.

It uses the repository belonging to the active session, including sessions in
worktrees. It finds the most recently created MR for the branch across all
states (open, merged, and closed), then asks `glab` to open it in your browser.
It does not create or modify merge requests. GitHub pull requests are not supported.

## Requirements

- OpenCode 2.0.27 or later in the V2 series, with a compatible Effect 4.0.1 runtime.
- [Git](https://git-scm.com/) and [GitLab CLI (`glab`)](https://gitlab.com/gitlab-org/cli)
  available on the OpenCode service's `PATH`.
- A local Git checkout on a branch, with a GitLab remote and an existing MR.
- A browser available on the machine running the OpenCode service.
- Node.js 24 and npm to install the plugin's dependencies.

Authenticate `glab` against your GitLab host before using the command:

```sh
glab auth login
```

For self-managed GitLab, use `glab auth login --hostname gitlab.example.com`.
Keep credentials in `glab`'s configuration, not in this repository.

## Install from a checkout

Clone this repository, then run these commands inside it:

```sh
npm ci
```

Add the checkout's absolute path to `plugins` in your global
`~/.config/opencode/opencode.json` or your GitLab project's `opencode.json`.
Preserve any existing configuration and plugin entries:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/oc-mr"],
}
```

Restart OpenCode's service if it is already running so it loads the plugin.
In a session located in your GitLab checkout, run:

```text
/mr
```

`glab` chooses the browser; set `BROWSER` in the OpenCode service's environment
to override the default.

## Troubleshooting

- **Can't determine the current branch:** check that the session is in a Git
  repository and not on a detached HEAD.
- **Can't find a merge request:** check `glab auth status`, your GitLab remote,
  and access to the project. If `git` or `glab` cannot be started, check the
  OpenCode service's `PATH`.
- **No merge request found:** create an MR for the current branch first.
- **Couldn't open it in a browser:** check the browser configuration on the
  service's machine. Remote or headless service installations need a browser
  opener appropriate to that environment.

## Development

Use Node.js 24, then:

```sh
npm ci
npm run patch:toolchain
npm run check
```

`check` runs formatting, linting, type checking, and tests. To apply formatting,
run `npm run format`. GitHub Actions runs the same checks on pushes and pull
requests. Tests use a fake process spawner; they do not contact GitLab or open
a browser.

For contributions, include a regression test when changing behavior and run
`npm run check` before opening a pull request. Do not include credentials,
private repository data, or local environment files in issues or commits.

## License

[ISC](LICENSE).
