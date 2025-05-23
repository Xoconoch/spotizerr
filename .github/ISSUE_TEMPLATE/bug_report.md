---
name: Bug report
about: Create a report to help us improve
title: "[BUG]"
labels: ''
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Precise steps to reproduce the behavior (start from how you built your container):
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Desktop (please complete the following information):**
 - OS: [e.g. iOS]
 - Browser [e.g. chrome, safari]

**docker-compose.yaml**
```
Paste it here
```
**Logs**
```
Preferably, restart the app before reproducing so you can paste the logs from the bare beginning
```

**Image**
Run 
```docker container ls --format "{{.Names}}: {{.Image}}"``` and share the relevant output (e.g. spotizerr: cooldockerizer93/spotizerr:latest)