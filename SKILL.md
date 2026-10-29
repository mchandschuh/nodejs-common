---
name: nodejs-common
description: Use the reusable Node.js common libraries, including safe configuration-root and file resolution with precedence and provenance.
category: [nodejs, libraries, configuration]
tags: [nodejs, typescript, configuration, paths, precedence, provenance]
priority: 0.8
auto_load: false
auto_activate: false
capabilities:
  - configuration_root_resolution
  - configuration_file_precedence
  - safe_relative_file_resolution
  - configuration_source_provenance
failure_modes:
  - accepting_absolute_config_file_paths
  - allowing_parent_traversal
  - silently_ignoring_invalid_environment_config
  - losing_configuration_source_provenance
  - merging_configuration_documents_without_contract
---

# nodejs-common

Reusable Node.js and TypeScript common libraries live under `src/{lib}`. The
configuration library is under `src/config` and is intentionally domain-neutral.

Configuration roots are resolved in precedence order:

```text
<application-source-directory>/.config/
~/.<app-slug>/
$<environment-variable>/
```

Later roots override earlier roots by relative file path. The environment root is
optional; when the selected environment variable is set, it must be an absolute
directory that exists. Relative file requests reject absolute paths, `..`
traversal, and symlink escapes. Resolved files retain their source provenance.
