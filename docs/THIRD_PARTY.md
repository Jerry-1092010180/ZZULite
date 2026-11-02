# 第三方来源与许可

本文件记录当前本地代码中已识别的参考来源；当前仓库先发布文档，源码与相应许可文件将在后续整理时一同上传。

## ZZUPocket

- 项目：https://github.com/3beuml/ZZUPocket
- 本地来源记录的参考提交：`746be4253620f352489da65f588a2a7dca6549cc`。
- MIT，版权信息：2026 3beuml。
- 学校统一认证与教务协议移植参考该项目；宿舍电量参考其 `data/ecard/EcardClient.kt` 的票据交换、在线房间树和剩余电量查询。
- 本地许可文件：`miniprogram/vendor/ZZUPocket-LICENSE.txt`。

## JSEncrypt

- 项目：https://github.com/travist/jsencrypt
- MIT；完整版权和许可文本保留在本地 `miniprogram/vendor/JSEncrypt-LICENSE.txt`。
- 为小程序添加局部 window/self 兼容层，通过 `wx.getRandomValues` 获取随机输入，禁用 `Math.random` 降级；用于学校公钥加密，不生成用户密钥。

## ZZUPy 许可文件

本地还包含 `miniprogram/vendor/ZZUPy-LICENSE.txt`，标注 MIT、Copyright © 2025 Illustar0。源码发布时应核对具体引用范围和对应上游地址，并保留该文件；当前不推断其对应代码或版本。

## 项目自身许可

上述第三方许可不自动决定 ZZULite 自身的许可。根目录项目许可证尚未确定，后续发布源码时会补齐。不得删除或替换第三方版权声明。
