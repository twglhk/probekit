import ResearchSection from "@/components/ResearchSection";

export default function Home() {
  return (
    <main className="flex flex-col items-center">
      <section className="w-full max-w-2xl mx-auto px-4 pt-24 pb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Is your business idea
          <br />
          <span className="text-blue-600">worth pursuing?</span>
        </h1>
        <p className="mt-4 text-lg text-gray-600 max-w-lg mx-auto">
          Describe the problem you want to solve. We&apos;ll analyze real
          conversations on X and Reddit to show you what people actually say
          about it.
        </p>
      </section>

      <ResearchSection />

      <footer className="mt-auto py-8 text-center text-xs text-gray-400">
        ProbeKit
      </footer>
    </main>
  );
}
