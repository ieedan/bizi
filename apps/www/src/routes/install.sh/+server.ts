import { redirect } from "@sveltejs/kit";

export function GET() {
	redirect(
		303,
		"https://raw.githubusercontent.com/ieedan/bizi/main/scripts/install"
	);
}
