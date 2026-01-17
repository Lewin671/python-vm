#!/bin/bash

# 从 package.json 获取版本号
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

echo "Checking if tag $TAG already exists..."

# 检查标签是否已存在
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "✓ Tag $TAG already exists, skipping tag creation."
    exit 0
fi

echo "Creating git tag: $TAG"

# 创建标签
git tag "$TAG" || {
    echo "✗ Failed to create tag $TAG"
    exit 1
}

echo "✓ Tag $TAG created successfully"
exit 0
