.PHONY: up down logs build restart clean

# 启动所有服务
up:
	docker compose up -d

# 停止所有服务
down:
	docker compose down

# 查看日志
logs:
	docker compose logs -f

# 构建镜像
build:
	docker compose build

# 重启
restart: down up

# 清理数据卷
clean:
	docker compose down -v

# 开发模式（不用 Docker）
dev:
	bash start.sh
