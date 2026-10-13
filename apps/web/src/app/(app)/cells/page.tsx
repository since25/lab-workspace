import CellsClient from "./CellsClient";

export default async function CellsPage({ searchParams }: PageProps<"/cells">) {
  const sp = await searchParams;
  return <CellsClient initialReview={sp.review === "1"} />;
}
