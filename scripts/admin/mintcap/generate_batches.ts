import fs from "fs"

async function main() {
	const input = require("./input.json")
	for (const chain of input) {
		let output = require("./batch_body_template.json")

		fs.writeFileSync(`.\output\${chain.network}.json`, output)
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error)
		process.exit(1)
	})

