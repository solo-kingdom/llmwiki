import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getApiStatsApiKeyDetail,
  getApiStatsApiKeys,
  getApiStatsErrors,
  getApiStatsOverview,
  getApiStatsRoutes,
} from "./api"
import { ApiStatsSection, ApiStatsTrendChart } from "@/pages/settings/api-stats"

function mockFetch(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? "OK" : "Forbidden",
    json: async () => body,
  }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("api-stats client & panel render", () => {
  it("builds query strings for all 5 api-stats endpoints", async () => {
    const fetchMock = mockFetch({})

    await getApiStatsOverview({ range: "7d", method: "GET", status_class: "2xx", auth_type: "api_key" })
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "/api/v1/api-stats/overview?range=7d&method=GET&status_class=2xx&auth_type=api_key",
    )

    await getApiStatsRoutes({ range: "24h", route: "/api/v1/documents/:id" }, { sort: "p95", limit: 25 })
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe(
      "/api/v1/api-stats/routes?range=24h&route=%2Fapi%2Fv1%2Fdocuments%2F%3Aid&sort=p95&limit=25",
    )

    await getApiStatsErrors({ range: "1h" }, 50)
    expect((fetchMock.mock.calls[2] as unknown as [string])[0]).toBe(
      "/api/v1/api-stats/errors?range=1h&limit=50",
    )

    await getApiStatsApiKeys({ range: "30d" })
    expect((fetchMock.mock.calls[3] as unknown as [string])[0]).toBe(
      "/api/v1/api-stats/api-keys?range=30d",
    )

    await getApiStatsApiKeyDetail("__invalid__", { range: "24h" })
    expect((fetchMock.mock.calls[4] as unknown as [string])[0]).toBe(
      "/api/v1/api-stats/api-keys/__invalid__?range=24h",
    )
  })

  it("renders ApiStatsTrendChart for both empty and populated series", () => {
    const emptyHtml = renderToStaticMarkup(React.createElement(ApiStatsTrendChart, { series: [], bucket: "hour" }))
    expect(emptyHtml).toContain("暂无趋势数据")

    const chartHtml = renderToStaticMarkup(
      React.createElement(ApiStatsTrendChart, {
        bucket: "hour",
        series: [
          {
            bucket_start: "2026-11-28T10:00:00.000Z",
            requests: 42,
            error_4xx: 2,
            error_5xx: 1,
            p95_ms: 85,
          },
          {
            bucket_start: "2026-11-28T11:00:00.000Z",
            requests: 18,
            error_4xx: 0,
            error_5xx: 0,
            p95_ms: 34,
          },
        ],
      }),
    )
    expect(chartHtml).toContain("请求量与延迟趋势图")
    expect(chartHtml).toContain("峰值 42")
  })

  it("renders ApiStatsSection with dual tabs and filter controls without crashing", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(ApiStatsSection),
      ),
    )
    expect(html).toContain("接口统计")
    expect(html).toContain("概览")
    expect(html).toContain("API Key 专项")
    expect(html).toContain("1 小时")
    expect(html).toContain("24 小时")
  })
})
