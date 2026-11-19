# QQ 空间相册下载 Chrome 插件

批量下载 QQ 空间相册照片的浏览器扩展，支持自定义下载数量限制。

![界面截图](image/img.png)

## 功能特点

- 批量下载 QQ 空间普通相册的全部照片
- 支持设置最大下载数量（默认 500 张）
- 自动打包为 ZIP 文件下载
- ZIP 自动使用当前相册名称，文件名中的 `/`、`\`、`:`、`*`、`?`、`"`、`<`、`>`、`|` 等非法字符替换为 `-`
- 照片文件名添加唯一序号（如 `0001_2022-02-25.jpg`），防止同名照片覆盖，并保留相册顺序，扩展名按实际图片格式保存
- 时间优先级：图片 EXIF 原始拍摄时间（`DateTimeOriginal`）→ 数字化时间（`CreateDate`）→ 元数据修改时间（`ModifyDate`）→ 相册接口拍摄时间（`rawshoottime` / `shootTime` / `shoottime`）→ 上传时间。缺失或无效的字段会跳过。ZIP 内的文件时间使用选中的时间，解压后对应“修改日期”；全部缺失时沿用打包时间。ZIP 时间精度为 2 秒。
- 将每张照片的时间信息写入图片内部：`QZonePhotoTime` 为按优先级选中的时间，`QZoneTimeSource` 标明来源，`QZoneUploadTime` 单独保留真实上传时间，不把拍摄时间冒充成上传时间。JPEG 使用 COM 备注，PNG 使用 iTXt 字段。不重新压缩图片，不覆盖已有 EXIF、拍摄日期或相机信息。Windows 资源管理器不一定直接显示这些内部字段。
- EXIF 未提供时区时保留其原始钟面时间，不擅自添加时区；QQ 空间时间戳按北京时间处理。接口仅提供日期时，内部保留日期，ZIP 文件时间使用当天 00:00:00，不从上传时间补造拍摄时分秒。
- 其他格式（如 WebP、GIF）保留原图片，选中的时间、来源和上传时间写入同名 `.metadata.json` 旁车文件，完成提示会显示数量，需与图片一起保存；没有有效时间时不编造时间。
- 实时显示下载进度

## 使用方法

### 安装插件

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目目录

### 下载相册

1. 登录 [QQ 空间](https://qzone.qq.com/)
2. 进入「我的相册」→ 选择具体相册
3. 点击插件图标，设置最大下载数量（留空表示全部）
4. 点击「下载相册」按钮

> **注意**：旅游相册接口不同，暂不支持。

## 工作原理

### 数据流向

```
QQ 相册页面 → background.js (拦截请求) → chrome.storage
                                            ↓
popup.html (用户点击下载) ← chrome.storage
              ↓
       popup.js (分页获取照片列表)
              ↓
       photoDownloader.js (Web Worker 下载)
              ↓
           JSZip 打包 → 浏览器下载
```

### 核心流程

1. **请求拦截**：拦截 QQ 相册 API 请求 `*://h5.qzone.qq.com/proxy/domain/photo.qzone.qq.com/fcgi-bin/cgi_list_photo*`，获取请求参数

2. **分页获取**：该接口单次最多返回 500 张照片，插件通过 `pageStart` 参数循环获取全部数据

3. **打包下载**：使用 Web Worker 在后台下载图片，通过 JSZip 打包成 ZIP 文件

## 项目结构

```
└── src
    ├── assets
    │   └── icon.png           # 扩展图标
    ├── background.js          # 后台脚本，拦截请求
    ├── jszip.min.js           # JSZip 库
    ├── photoDownloader.js     # Web Worker，下载图片
    ├── popup.html             # 弹窗界面
    ├── popup.js               # 主逻辑
    └── styles.css             # 样式文件
```

## 故障排查

EXIF 读取使用随扩展打包的 [exifr 7.1.3](https://github.com/MikeKovarik/exifr/tree/v7.1.3)，MIT 许可见 `src/vendor/exifr-LICENSE.txt`，运行时不需要联网加载该库。

如果遇到问题：
- 右键插件图标 → 检查弹出窗口
- 右键插件图标空白处 → 检查后台控制台
- 查看网络请求是否正常

---

^ ⑉・ᴗ・⑉ ૮ ˃ 感谢支持<br />
<img src="https://github.com/user-attachments/assets/8b12eac8-cb25-435d-b098-bd4de82f8777" width="300" />
