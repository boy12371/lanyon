env DOCKER_BUILD=0 DEBUG=*:* LANYON_DISABLE="rbenv brew system rvm" PROJECT_DIR=$HOME/code/content node postinstall.js
env DOCKER_BUILD=0 DEBUG=*:* LANYON_DISABLE="rbenv brew system rvm" PROJECT_DIR=$HOME/code/content npm run build:content
