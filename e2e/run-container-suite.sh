#!/usr/bin/env bash
set -euo pipefail

suffix=$$
network=modern-ui-e2e-$suffix
frontend=modern-ui-e2e-frontend-$suffix
abs=modern-ui-e2e-abs-$suffix
psb=modern-ui-e2e-psb-$suffix
runner=modern-ui-e2e-runner-$suffix
bun=modern-ui-e2e-bun-$suffix
bun_file=$(mktemp)
cleanup() {
	if [ "$?" -ne 0 ]; then docker logs "$frontend" --tail 40 2>&1 || true; fi
	docker rm -f "$frontend" "$abs" "$psb" "$runner" "$bun" >/dev/null 2>&1 || true
	docker network rm "$network" >/dev/null 2>&1 || true
	rm -f "$bun_file"
}
cleanup
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --rm --name "$abs" --network "$network" --network-alias audiobookshelf -e FIXTURE_PORT=80 modern-ui-e2e:abs >/dev/null
docker run -d --rm --name "$psb" --network "$network" --network-alias sidecar-mock modern-ui-e2e:psb >/dev/null
docker run -d --rm --name "$frontend" --network "$network" --network-alias modern-ui-e2e-frontend \
	-e ABS_UPSTREAM=http://audiobookshelf:80 -e PSB_UPSTREAM=http://sidecar-mock:4181 \
	modern-ui-e2e:frontend >/dev/null
for attempt in {1..30}; do
	if docker exec "$frontend" wget -q -O /dev/null http://127.0.0.1:8080/health; then break; fi
	sleep 1
done
docker exec "$frontend" wget -q -O /dev/null http://127.0.0.1:8080/health
docker exec "$frontend" /usr/local/bin/bun --version
docker exec "$frontend" /usr/local/bin/bun -e 'const login = await fetch("http://audiobookshelf/login", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"password"})}); const {user} = await login.json(); const response = await fetch("http://127.0.0.1:3001/auth", {headers:{Authorization:`Bearer ${user.accessToken}`}}); console.log("debug backend auth",response.status); if(!response.ok) process.exit(1)'
docker create --name "$bun" oven/bun:1.4.3 >/dev/null
docker create --name "$runner" --network "container:$frontend" -w /app -e CI=1 \
	-e BUILT_BASE_URL=http://127.0.0.1:8080 -e ABS_MOCK_CONTROL_URL=http://audiobookshelf:80 \
	mcr.microsoft.com/playwright:v1.64.1-noble \
	bash -c 'bun install --frozen-lockfile && bun x playwright test' >/dev/null
docker cp "$bun:/usr/local/bin/bun" "$bun_file"
docker cp "$bun_file" "$runner:/usr/local/bin/bun"
tar --exclude=.git --exclude=node_modules --exclude=dist --exclude=test-results -cf - . | docker cp - "$runner:/app"
docker start -a "$runner"
test "$(docker inspect -f '{{.State.ExitCode}}' "$runner")" -eq 0
