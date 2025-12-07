#!/bin/env node

import fs from "fs/promises";

let error = false;

const validIPs = new Set();

async function getMasterServerData() {
	let data;
	data = await fetch("https://master1.ddnet.org/ddnet/15/servers.json");
	data = await data.json();
	for (const { addresses } of data.servers)
		for (const address of addresses)
			validIPs.add(address.split("://").at(-1));
}
await getMasterServerData();

const data = JSON.parse(await fs.readFile("custom-communities-ddnet-info.json"));
for (let {id, icon: { servers }} of data.communities) {
	for (const { servers: regions } of servers) {
		for (const address of Object.values(regions).flat()) {
			if (!validIPs.has(address)) {
				console.error(`Address not found in master server: ${id}/${address}`);
				error = true;
			}
		}
	}
}

if (error)
	process.exit(1);