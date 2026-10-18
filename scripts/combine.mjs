#!/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createReadStream } from "node:fs";

const RAW_URL = "https://raw.githubusercontent.com/TaterClient/ddnet-custom-communities/refs/heads/main";

async function sha256File(file) {
	const hash = crypto.createHash("sha256");
	await pipeline(
		createReadStream(file),
		hash,
	);
	return hash.digest("hex");
}

async function parse(file, { name, contactUrls, regions }) {
	const id = path.basename(file, ".json");
	const iconSha256 = await sha256File(path.join("icons", id + ".png"));
	return {
		id, name,
		has_finishes: false,
		icon: {
			sha256: iconSha256,
			url: `${RAW_URL}/icons/${id}.png`,
			servers: regions,
		},
		contact_urls: contactUrls,
	}
}

const communities = [];

for (const file of (await fs.readdir("data")).filter(file => file.endsWith(".json"))) {
	communities.push(await parse(file, JSON.parse(await fs.readFile(path.join("data", file)))))
}
communities.sort((a, b) => a.id.localeCompare(b.id, "en", {
	usage: "sort",
	sensitivity: "variant",
	numeric: false,
	ignorePunctuation: false,
}));

const out = { communities: communities }

await fs.writeFile("custom-communities-ddnet-info.json", JSON.stringify(out, null, "\t"));
