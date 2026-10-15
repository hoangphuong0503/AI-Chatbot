# Meet Amy: the Austra College study assistant

**A simple guide to the app, its purpose and the technology behind it.**

## 1. What is Amy for?

Amy is an English-language chatbot that helps people find information about Austra College without searching through many web pages and PDF documents.

Its main audience is prospective students and people helping them choose a course. It can also help staff find published information. The goal is to make routine information easier to access and reduce repeated enquiries to admissions.

Visitors ask questions in ordinary language. Amy searches the prepared Austra information and either returns a checked fact or asks an AI model to explain the relevant material.

**Amy is an information assistant. It does not enrol students, take payments, access private student records or make official admissions decisions.**

## 2. What can people ask?

| Topic | Example question |
|---|---|
| Courses | What can I study at Austra? |
| Fees | What are the tuition and total fees for SIT30821? |
| Entry requirements | What IELTS score is required for CPC30220? |
| Duration | How long does Certificate III in Commercial Cookery take? |
| Intakes | What are the November intakes for MSF30422 in South Australia? |
| Campuses | What is the Adelaide campus address? |
| Policies | How do I make a complaint? |
| Forms | When should I complete the Change of Details Form? |

Amy can use recent conversation context. For example, after discussing a course's Victorian intake, a visitor can ask, "What about South Australia?" It should keep the course and change the state.

When important details are missing, Amy can ask for clarification. A published intake date does not prove that places are available, and a blank form does not contain an actual student's or agent's records.

## 3. Where does the information come from?

The app uses public material collected from the Austra website, including course pages, fee information, intake schedules, policies and linked PDF forms.

The prepared snapshot currently contains **114 documents and 2,117 searchable passages**. Some scanned forms were processed with **OCR**, which means turning text in an image into searchable text. Those recovered form pages were also reviewed.

Long documents are divided into smaller passages. Each passage keeps details such as its source address, course identity, section and PDF page number where available. This helps the app retrieve the right evidence and lets the developer investigate an answer.

The data is a snapshot, not a live connection to admissions. Website changes must be collected, reviewed and added. Complete coverage of every website image or broken page has not been established, and some forms are older versions.

## 4. How does Amy produce an answer?

This approach is called **RAG: Retrieval-Augmented Generation**. In plain English, it means "find the information first, then write the answer using it."

### For a simple fact

Amy first checks whether it can answer from a structured lookup. Examples include a course's listed fees or intake dates for a specific course and state. These lookups avoid an unnecessary AI call and preserve exact values and conditions.

### For a broader question

1. **Understand the question.** Identify the course, state and recent conversation context. Rewrite the question for searching only when needed.
2. **Search in two ways.** Keyword search finds exact terms such as course codes. Meaning-based search finds related passages even when the visitor uses different wording.
3. **Combine the results.** A method called RRF combines the two ranked lists.
4. **Check relevance.** A reranker chooses the passages most useful for answering the question.
5. **Write the answer.** DeepSeek receives the question and selected evidence and writes a concise English response.

The two searches together are called **hybrid search**. The keyword method is **BM25**. An **embedding** is the numerical representation used for meaning-based search. A **reranker** sorts the retrieved evidence; it does not write the final reply.

Amy also caches successful results temporarily. An identical question with matching context can reuse a previous answer. Different conversation contexts must not share the wrong cached answer.

## 5. What technology does the app use?

| Technology | Its job in the app |
|---|---|
| React + Vite | Build and display the chat interface |
| TypeScript | The language used for the interface and backend |
| Node.js + Express | Run the backend that coordinates searches and AI requests |
| Python | Collect and prepare source documents; run the newer local reranker |
| Supabase | The cloud database service |
| PostgreSQL + pgvector | Store the source records and searchable numerical vectors inside Supabase |
| BGE-M3 through Ollama | Create embeddings on the local computer |
| DeepSeek V4 Flash (`deepseek-v4-flash-0731`) | Rewrite questions when necessary and generate answers through the configured Intern AI API |
| BGE reranker v2 M3 | The dedicated local reranker evaluated in the latest development version |

**Version note:** the published code baseline uses DeepSeek for reranking as well as answering. A newer version tested on the developer's computer uses BGE reranker locally while keeping DeepSeek for answers. This documentation update does not publish that newer implementation. The developer should confirm the installed version before setup or deployment.

The working local setup therefore combines the developer's computer, Supabase cloud and an external DeepSeek service. It is not fully offline. External embedding and reranking APIs are possible future alternatives; they have not yet been selected and integrated for public deployment.

## 6. What does the visitor experience?

The interface includes suggested questions, a conversation view and replies that appear progressively while the model writes. Visitors can start a new chat, copy an answer, stop a response or retry after an error.

The screen shows service availability and provides an admissions contact. Numbered references and source panels are hidden in the visitor interface, while the backend retains source information for checking.

The conversation uses recent messages for context. This is not a permanent student profile or a student account system.

## 7. What has been tested, and what are the limits?

The latest local reranker comparison checked the same **65 questions before and after the change**. Both versions passed the specified checks. The questions covered course facts, fees, state-specific intakes, policies, scanned forms and requests for information that was not available.

For the **25 questions using hybrid search**, median full-answer time in that comparison improved from about **9.1 seconds to 3.7 seconds**, with empty answer/search caches. This was measured on the developer's GPU-equipped computer. External API load varied, and the figures do not guarantee performance on a hosting service.

Passing the checks does not prove every sentence is correct. Refund follow-ups still showed a shortened deduction rule in both versions, so policy wording needs correction and staff review before launch. Older documents, missing evidence, ambiguous questions and provider outages also require care.

## 8. What does running Amy require?

For the current local demonstration, the developer's computer and app must stay on. Ollama supplies BGE-M3 embeddings, Supabase must be reachable, and the configured DeepSeek API account must have available access and quota. The newer local reranker also needs its Python environment and downloaded model.

The app does **not** crawl the entire website or recreate all document embeddings every time it starts. Document preparation and upload are separate tasks. New search questions may still require a query embedding.

For public use without the developer's computer, the app needs hosting and a decision about where both search models will run. Hosting, database and AI usage can have separate costs or free-tier limits. A free local model does not make the whole online service free.

The project is currently a working demonstration, not a completed production integration. Before attaching it to Austra's website, the team must finish hosting, the compact chat widget, operational limits, privacy decisions, content approval and maintenance arrangements.

## Where to go next

- **Project owner or website administrator:** read the [Website Launch Guide](WEBSITE_LAUNCH_GUIDE.md) for responsibilities and the launch checklist.
- **Developer:** read the [README](../README.md) for the published version's installation and technical details.
- **Anyone reviewing answers:** confirm important fees, intake availability and policy decisions with Austra admissions.
