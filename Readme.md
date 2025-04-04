# Effect Cluster + SST Cluster

This is just a sandbox for me to tinker with Effect Cluster.

Thanks to [sellooh/effect-cluster-via-sst](https://github.com/sellooh/effect-cluster-via-sst) for making this quick and easy to get up and running.

## Description

This analyzes an archive of files and stores the analysis in a way that AI agents can access.

I wanted to be able to download a zip file (i.e. a github release), iterate over the files, and analyze them. It seemed like an interesting way to generate summaries of codebases, like a "get up to speed quickly" kind of tool.

I'm also toying around with [Zep](https://help.getzep.com/welcome), which is "a memory layer for AI assistants." I was thinking of providing information via MCP to an agent, so that I can converse with it about a repository.
