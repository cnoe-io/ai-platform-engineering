Instructions to migrate agent repos to mono repo

1. Clone the Target Monorepo (ai-platform-engineering)

```
cd /tmp
git clone git@github.com:cnoe-io/ai-platform-engineering.git
```

2. Clone agent-argocd to a temp location:
```
cd /tmp
git clone git@github.com:cnoe-io/agent-argocd.git agent-argocd-temp
cd agent-argocd-temp
```

3. Rewrite history to move everything into ai_platform_engineering/agents/argocd:

```
git filter-repo --to-subdirectory-filter ai_platform_engineering/agents/argocd
```

4. Now add this rewritten repo as a remote to your monorepo:

```
cd ../ai-platform-engineering    # Go back to your main repo
git remote add argocd-temp ../agent-argocd-temp
git fetch argocd-temp
```

5. Create a branch

```
git checkout -b migrate_agent_argocd
```

6. Merge the imported history (use --allow-unrelated-histories the first time):

```
git merge argocd-temp/main --allow-unrelated-histories
```

7. Clean Up (Optional)

```
git remote remove agent-argocd
git remote remove argocd-temp
rm -rf ../agent-argocd-temp
```

8. Upload branch and PR

```
git push origin migrate_agent_argocd
```

<!-- truncate -->