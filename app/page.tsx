"use client";
import dynamic from "next/dynamic";

const IGGridPlanner = dynamic(() => import("@/components/IGGridPlanner"), {
  ssr: false,
});

export default function Home() {
  return <IGGridPlanner />;
}
