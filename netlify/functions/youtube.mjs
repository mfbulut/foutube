const vm = require("node:vm");

async function fetchData(url, options) {
    const response = await fetch(url, options);
    return response.text();
}

async function retrieveMetadata(videoId) {
    const response = await fetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            videoId: videoId,
            context: {
                client: { clientName: "WEB", clientVersion: "2.20230810.05.00" },
            },
        }),
    });

    if (!response.ok) {
        console.error("Request failed with status:", response.status);
        return null;
    }

    const responseData = await response.json();
    const formats = responseData.streamingData.adaptiveFormats;
    const videoFormat = formats.find((w) => w.mimeType.startsWith("video/webm"));
    const audioFormat = formats.find((w) => w.mimeType.startsWith("audio/webm"));

    return [responseData.videoDetails.title, videoFormat, audioFormat];
}

async function retrieveChallenge(video_id) {
    let player_response = await fetchData("https://www.youtube.com/embed/" + video_id);
    let player_hash = /\/s\/player\/(\w+)\/player_ias.vflset\/\w+\/base.js/.exec(player_response)[1];
    const player_url = `https://www.youtube.com/s/player/${player_hash}/player_ias.vflset/en_US/base.js`;

    let response = await fetchData(player_url);
    let challenge_name = /\.get\("n"\)\)&&\(b=([a-zA-Z0-9$]+)(?:\[(\d+)\])?\([a-zA-Z0-9]\)/.exec(response)[1];
    challenge_name = new RegExp(`var ${challenge_name}\\s*=\\s*\\[(.+?)\\]\\s*[,;]`).exec(response)[1];

    const challenge = new RegExp(
        `${challenge_name}\\s*=\\s*function\\s*\\(([\\w$]+)\\)\\s*{(.+?}\\s*return\\ [\\w$]+.join\\(""\\))};`,
        "s"
    ).exec(response)[2];
    return challenge;
}

function solveChallenge(challenge, formatUrl) {
    const url = new URL(formatUrl);
    const n = url.searchParams.get("n");
    const n_transformed = vm.runInNewContext(`((a) => {${challenge}})('${n}')`);
    url.searchParams.set("n", n_transformed);
    return url.toString();
}

function extractVideoID(url) {
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#\&\?]*).*/;
    var match = url.match(regExp);
    if (match && match[7].length == 11) {
        return match[7];
    } else {
        return null;
    }
}

const handler = async (event, context) => {
    let videoId = extractVideoID(event.queryStringParameters.link);
    if (!videoId) {
        return { statusCode: 400, body: "Missing video link" };
    }

    const [title, video, audio] = await retrieveMetadata(videoId);
    if (!title || !video || !audio) {
        return { statusCode: 500, body: "Failed to retrieve metadata" };
    }

    const challenge = await retrieveChallenge(videoId);

    video.url = solveChallenge(challenge, video.url);
    audio.url = solveChallenge(challenge, audio.url);

    return {
        statusCode: 200,
        body: JSON.stringify({ title, video: video.url, audio: audio.url }),
    };
};

export { handler };
