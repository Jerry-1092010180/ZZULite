# 第三方来源与许可

本文件记录当前代码中已识别的参考来源，第三方许可文件随源码保留。

## ZZUPocket

- 项目：https://github.com/3beuml/ZZUPocket
- 本地来源记录的参考提交：`746be4253620f352489da65f588a2a7dca6549cc`。
- MIT，版权信息：2026 3beuml。
- 学校统一认证与教务协议移植参考该项目；宿舍电量参考其 `data/ecard/EcardClient.kt` 的票据交换、在线房间树和剩余电量查询。
- 许可文件：`miniprogram/vendor/ZZUPocket-LICENSE.txt`。

## JSEncrypt

- 项目：https://github.com/travist/jsencrypt
- MIT；完整版权和许可文本保留在本地 `miniprogram/vendor/JSEncrypt-LICENSE.txt`。
- 为小程序添加局部 window/self 兼容层，通过 `wx.getRandomValues` 获取随机输入，禁用 `Math.random` 降级；用于学校公钥加密，不生成用户密钥。

## ZZUPy 许可文件

仓库还包含 `miniprogram/vendor/ZZUPy-LICENSE.txt`，标注 MIT、Copyright © 2025 Illustar0。保留该文件；其具体引用范围和对应上游地址仍待进一步核对，当前不推断其对应代码或版本。

## 微信小程序类型声明

`typings/types/wx/` 包含 Tencent 的微信 API 类型声明，文件头保留 Copyright (c) 2021 Tencent, Inc. 及完整 MIT 许可文本。请保留这些文件头。

## 项目自身许可

ZZULite 原作者有权许可的原创贡献现采用根目录 LICENSE 所列 ZZULite Attribution License 1.0（自定义、非标准 MIT）。第三方代码仍按各自许可使用，不受本项目新增署名条件的重新许可；不得删除或替换其版权声明。历史 MIT 版本说明见 ../ATTRIBUTION.md。
