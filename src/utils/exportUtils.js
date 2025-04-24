/**
 * 生成最新 meta & conn JSON 并通过 Blob 触发下载
 */
export function exportJson(metaTree, connections) {
    const metaBlob = new Blob([JSON.stringify({ meta: metaTree }, null, 2)], {
        type: "application/json"
    });
    const connBlob = new Blob([JSON.stringify({ data: connections }, null, 2)], {
        type: "application/json"
    });

    downloadBlob(metaBlob, "new_meta_data.json");
    downloadBlob(connBlob, "new_conn_data.json");
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
}
