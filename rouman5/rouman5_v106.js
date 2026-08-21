class Rouman5Source extends ComicSource {
    name = "肉漫屋 v1.0.6"
    key = "rouman5_v106"
    version = "1.0.6"
    minAppVersion = "1.0.5"
    url = "https://raw.githubusercontent.com/kkiki11/venera-comic-sources/master/rouman5/rouman5_v106.js"

    baseUrl = "https://rouman5.com"
    ua = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"

    get pageHeaders() {
        return {
            "User-Agent": this.ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": this.baseUrl + "/home"
        }
    }

    get imageHeaders() {
        return {
            "User-Agent": this.ua,
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Referer": this.baseUrl + "/"
        }
    }

    account = {
        loginWithWebview: {
            url: this.baseUrl + "/auth/email-signin",
            checkStatus: (url, title) => {
                let value = String(url || "")
                return value.startsWith(this.baseUrl + "/") && !value.includes("/auth/") && !value.includes("/api/auth/")
            }
        },
        logout: () => Network.deleteCookies(this.baseUrl)
    }

    absolute(url) {
        let value = String(url || "").trim()
        if (!value) return ""
        if (value.startsWith("//")) return "https:" + value
        if (/^https?:\/\//i.test(value)) return value
        if (value.startsWith("/")) return this.baseUrl + value
        return this.baseUrl + "/" + value
    }

    cleanText(value) {
        return String(value || "").replace(/\s+/g, " ").trim()
    }

    textOf(element) {
        return element ? this.cleanText(element.text) : ""
    }

    bookIdFrom(url) {
        let match = String(url || "").match(/^\/books\/([^\/?#]+)\/?$/)
        return match ? match[1] : ""
    }

    episodeIdFrom(url) {
        let match = String(url || "").match(/^\/books\/([^\/?#]+)\/(\d+)\/?$/)
        return match ? match[2] : ""
    }

    async getDocument(path) {
        let response = await Network.get(this.absolute(path), this.pageHeaders)
        if (!response || response.status < 200 || response.status >= 300) {
            throw "页面请求失败：" + String(response ? response.status : "无响应")
        }
        return new HtmlDocument(response.body)
    }

    async getText(path) {
        let response = await Network.get(this.absolute(path), this.pageHeaders)
        if (!response || response.status < 200 || response.status >= 300) {
            throw "页面请求失败：" + String(response ? response.status : "无响应")
        }
        return String(response.body || "")
    }

    coverFrom(container) {
        let image = container.querySelector("img")
        if (image) {
            let src = image.attributes["data-src"] || image.attributes["src"] || ""
            if (src && !src.includes("loading.jpg")) return this.absolute(src)
        }
        let boxes = container.querySelectorAll("div")
        for (let box of boxes) {
            let style = box.attributes["style"] || ""
            let match = style.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i)
            if (match) return this.absolute(match[1])
        }
        return ""
    }

    parseCard(anchor) {
        if (!anchor) return null
        let href = anchor.attributes["href"] || ""
        let id = this.bookIdFrom(href)
        if (!id) return null
        let title = this.textOf(anchor.querySelector(".truncate"))
        if (!title) {
            let chunks = anchor.querySelectorAll("div").map((item) => this.textOf(item)).filter((item) => !!item)
            title = chunks.length > 0 ? chunks[0] : ""
        }
        if (!title) return null
        let muted = anchor.querySelectorAll(".text-muted-foreground").map((item) => this.textOf(item)).filter((item) => !!item)
        let subtitle = muted.length > 0 ? muted[0].replace(/^至:\s*/, "") : ""
        return new Comic({ id: id, title: title, subtitle: subtitle, cover: this.coverFrom(anchor), tags: [], description: "" })
    }

    uniqueComics(comics) {
        let seen = {}
        let result = []
        for (let comic of comics) {
            if (comic && comic.id && !seen[comic.id]) {
                seen[comic.id] = true
                result.push(comic)
            }
        }
        return result
    }

    parseCards(document) {
        let anchors = document.querySelectorAll("a[href*='/books/']")
        return this.uniqueComics(anchors.map((item) => this.parseCard(item)).filter((item) => !!item))
    }

    maxPage(document) {
        let maximum = 0
        for (let link of document.querySelectorAll("a[href*='page=']")) {
            let href = link.attributes["href"] || ""
            let match = href.match(/[?&]page=(\d+)/)
            if (match) maximum = Math.max(maximum, Number(match[1]))
        }
        return maximum + 1
    }

    listPath(continued, page) {
        return "/books?continued=" + (continued ? "true" : "false") + "&page=" + Math.max(0, (page || 1) - 1)
    }

    extractImageUrls(html) {
        let normalized = String(html || "").replace(/"\]\)<\/script><script>self\.__next_f\.push\(\[1,"/g, "").replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\u0026/g, "&")
        let result = []
        let seen = {}
        let regex = /"imageUrl"\s*:\s*"(https?:[^"\s]+)"/g
        let match
        while ((match = regex.exec(normalized)) !== null) {
            let url = this.absolute(match[1])
            if (url && !seen[url]) {
                seen[url] = true
                result.push(url)
            }
        }
        return result
    }

    imageSegmentCount(url) {
        try {
            let file = String(url || "").split("/").pop().split("?")[0]
            let encoded = file.split(".").slice(0, -1).join(".")
            if (!encoded) return 0
            let remainder = encoded.length % 4
            if (remainder) encoded += "====".slice(remainder)
            let hash = new Uint8Array(Convert.md5(Convert.decodeBase64(encoded)))
            return hash.length > 0 ? hash[hash.length - 1] % 10 + 5 : 0
        } catch (e) {
            return 0
        }
    }

    imageModifyScript(count) {
        return "function modifyImage(image) { var count = " + Number(count) + "; var width = image.width; var height = image.height; if (!width || !height || count < 5 || height < count) return image; var output = Image.empty(width, height); var extra = height % count; for (var index = 0; index < count; index++) { var part = Math.floor(height / count); var targetY = part * index; var sourceY = height - part * (index + 1) - extra; if (index === 0) { part += extra; } else { targetY += extra; } output.fillImageRangeAt(0, targetY, image, 0, sourceY, width, part); } return output; }"
    }

    explore = [
        {
            title: "肉漫屋",
            type: "multiPageComicList",
            load: async (page) => {
                let document = await this.getDocument(this.listPath(true, page || 1))
                return { comics: this.parseCards(document), maxPage: Math.max(1, this.maxPage(document)) }
            }
        }
    ]

    category = {
        title: "漫画筛选",
        parts: [
            {
                name: "状态",
                type: "fixed",
                categories: ["连载中", "已完结"],
                itemType: "category",
                categoryParams: ["true", "false"],
                groupParam: null
            }
        ],
        enableRankingPage: false
    }

    categoryComics = {
        optionList: [],
        load: async (category, param, options, page) => {
            let document = await this.getDocument(this.listPath(String(param) === "true", page || 1))
            return { comics: this.parseCards(document), maxPage: Math.max(1, this.maxPage(document)) }
        }
    }

    search = {
        optionList: [],
        load: async (keyword, options, page) => {
            let path = "/search?term=" + encodeURIComponent(keyword) + "&page=" + Math.max(0, (page || 1) - 1)
            let document = await this.getDocument(path)
            return { comics: this.parseCards(document), maxPage: Math.max(1, this.maxPage(document)) }
        }
    }

    favorites = {
        multiFolder: false,
        loadComics: async (page, folder) => {
            let path = "/my-book-shelf?tab=reading&page=" + Math.max(0, (page || 1) - 1)
            let document = await this.getDocument(path)
            let comics = this.parseCards(document)
            if (comics.length === 0) {
                let text = this.textOf(document.querySelector("main") || document.querySelector("body"))
                if (text.includes("郵箱密碼登入") || text.includes("Sign in to your account")) throw "请先在账号页面通过网页登录肉漫屋"
            }
            return { comics: comics, maxPage: Math.max(1, this.maxPage(document)) }
        }
    }

    comic = {
        loadInfo: async (id) => {
            let document = await this.getDocument("/books/" + id)
            let coverImage = document.querySelector("img.rounded") || document.querySelector("img")
            let cover = coverImage ? this.absolute(coverImage.attributes["src"] || "") : ""
            let titleNode = document.querySelector(".text-xl")
            let title = this.textOf(titleNode)
            if (!title && coverImage) title = this.cleanText(coverImage.attributes["alt"] || "").replace(/\s+cover$/i, "")
            if (!title) throw "未找到漫画标题"
            let descriptionNode = document.querySelector(".my-2 p")
            let description = this.textOf(descriptionNode).replace(/^簡介\s*[:：]\s*/, "")
            let chapters = new Map()
            for (let item of document.querySelectorAll("a[href*='/books/']")) {
                let href = item.attributes["href"] || ""
                let match = href.match(/^\/books\/([^\/?#]+)\/(\d+)\/?$/)
                if (match && match[1] === id) {
                    let name = this.textOf(item)
                    if (name) chapters.set(match[2], name)
                }
            }
            if (chapters.size === 0) throw "未找到章节列表"
            return new ComicDetails({
                title: title,
                cover: cover,
                description: description,
                tags: {},
                chapters: chapters,
                isFavorite: false,
                thumbnails: null,
                recommend: this.parseCards(document),
                url: this.absolute("/books/" + id)
            })
        },

        loadEp: async (comicId, epId) => {
            let html = await this.getText("/books/" + comicId + "/" + epId)
            let images = this.extractImageUrls(html)
            if (images.length === 0) throw "章节图片为空"
            return { images: images }
        },

        onImageLoad: (url) => {
            let config = { headers: this.imageHeaders }
            if (String(url || "").includes("sr:1")) {
                let count = this.imageSegmentCount(url)
                if (count >= 5 && count <= 14) config.modifyImage = this.imageModifyScript(count)
            }
            return config
        },

        onThumbnailLoad: (url) => ({ headers: this.imageHeaders }),

        idMatch: "https?://(?:www\\.)?rouman5\\.com/books/([^/?#]+)",
        link: {
            domains: ["rouman5.com", "www.rouman5.com"],
            linkToId: (url) => this.bookIdFrom(String(url || "").replace(this.baseUrl, ""))
        }
    }
}
