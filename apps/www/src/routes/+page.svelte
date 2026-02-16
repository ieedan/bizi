<script lang="ts">

</script>

<svelte:head>
    <title>bizi</title>
    <meta name="description" content="Manage dependent concurrent tasks with sanity." />
</svelte:head>

<main class="h-dvh flex items-center justify-center"> 
    <div class="max-w-xl w-full">
        <h1 class="text-6xl font-bold text-center mb-2">bizi</h1>
        <p class="mb-8 text-center text-lg text-muted-foreground">Manage dependent concurrent tasks with sanity.</p>

        <h2 class="text-xl font-bold mb-2">1. Install the server</h2>
        <Snippet class="mb-6" text="curl -fsSL https://getbizi.dev/install | bash" />

        <h2 class="text-xl font-bold mb-2">2. Install the client</h2>
        <PMCommand class="mb-6" command="install" args={["bizi", '-g']} />
    </div>
</main>