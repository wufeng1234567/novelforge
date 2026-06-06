--
-- PostgreSQL database dump
--

\restrict dJvNvEXZ7Jit8eVtbQTVZ6ddfUOqxwjgbKMccbKqIIGebNjYQxn6NfPYpohH2lL

-- Dumped from database version 16.14 (Debian 16.14-1.pgdg13+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: chapter_versions; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.chapter_versions (
    id character varying(36) NOT NULL,
    chapter_id character varying(36) NOT NULL,
    version_number integer NOT NULL,
    content character varying NOT NULL,
    word_count integer NOT NULL,
    is_locked boolean NOT NULL,
    created_at timestamp without time zone NOT NULL
);


ALTER TABLE public.chapter_versions OWNER TO root;

--
-- Name: chapters; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.chapters (
    id character varying(36) NOT NULL,
    project_id character varying(36) NOT NULL,
    chapter_number integer NOT NULL,
    title character varying(200) NOT NULL,
    content character varying NOT NULL,
    word_count integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


ALTER TABLE public.chapters OWNER TO root;

--
-- Name: character_relationships; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.character_relationships (
    id character varying(36) NOT NULL,
    project_id character varying(36) NOT NULL,
    from_char_id character varying(36) NOT NULL,
    to_char_id character varying(36) NOT NULL,
    relation_type character varying(50) NOT NULL,
    intimacy integer NOT NULL,
    description character varying(500),
    created_at timestamp without time zone NOT NULL
);


ALTER TABLE public.character_relationships OWNER TO root;

--
-- Name: characters; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.characters (
    id character varying(36) NOT NULL,
    project_id character varying(36) NOT NULL,
    name character varying(100) NOT NULL,
    avatar_url character varying(500),
    gender character varying(20),
    age character varying(50),
    appearance character varying,
    personality character varying,
    abilities character varying,
    background character varying,
    status character varying(50),
    quotes character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


ALTER TABLE public.characters OWNER TO root;

--
-- Name: project_settings; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.project_settings (
    id character varying(36) NOT NULL,
    project_id character varying(36) NOT NULL,
    default_model character varying(100),
    temperature double precision NOT NULL,
    max_tokens integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


ALTER TABLE public.project_settings OWNER TO root;

--
-- Name: projects; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.projects (
    id character varying(36) NOT NULL,
    user_id character varying(36) NOT NULL,
    title character varying(200) NOT NULL,
    description character varying(2000),
    genre character varying(50),
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


ALTER TABLE public.projects OWNER TO root;

--
-- Name: story_branches; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.story_branches (
    id character varying(36) NOT NULL,
    project_id character varying(36) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(500),
    parent_chapter_id character varying(36),
    created_at timestamp without time zone NOT NULL
);


ALTER TABLE public.story_branches OWNER TO root;

--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.user_sessions (
    id character varying(36) NOT NULL,
    user_id character varying(36) NOT NULL,
    refresh_token character varying(500) NOT NULL,
    device_info character varying(255),
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone NOT NULL
);


ALTER TABLE public.user_sessions OWNER TO root;

--
-- Name: users; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.users (
    id character varying(36) NOT NULL,
    email character varying(255) NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    nickname character varying(50) NOT NULL,
    avatar_url character varying(500),
    is_active boolean NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


ALTER TABLE public.users OWNER TO root;

--
-- Name: world_modules; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.world_modules (
    id character varying(36) NOT NULL,
    project_id character varying(36) NOT NULL,
    module_type character varying(30) NOT NULL,
    title character varying(200) NOT NULL,
    content character varying NOT NULL,
    tags character varying(500),
    parent_id character varying(36),
    sort_order integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


ALTER TABLE public.world_modules OWNER TO root;

--
-- Name: world_rules; Type: TABLE; Schema: public; Owner: root
--

CREATE TABLE public.world_rules (
    id character varying(36) NOT NULL,
    project_id character varying(36) NOT NULL,
    content character varying NOT NULL,
    priority integer NOT NULL,
    created_at timestamp without time zone NOT NULL
);


ALTER TABLE public.world_rules OWNER TO root;

--
-- Name: chapter_versions chapter_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.chapter_versions
    ADD CONSTRAINT chapter_versions_pkey PRIMARY KEY (id);


--
-- Name: chapters chapters_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.chapters
    ADD CONSTRAINT chapters_pkey PRIMARY KEY (id);


--
-- Name: character_relationships character_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.character_relationships
    ADD CONSTRAINT character_relationships_pkey PRIMARY KEY (id);


--
-- Name: characters characters_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id);


--
-- Name: project_settings project_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.project_settings
    ADD CONSTRAINT project_settings_pkey PRIMARY KEY (id);


--
-- Name: project_settings project_settings_project_id_key; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.project_settings
    ADD CONSTRAINT project_settings_project_id_key UNIQUE (project_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: story_branches story_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.story_branches
    ADD CONSTRAINT story_branches_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: world_modules world_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.world_modules
    ADD CONSTRAINT world_modules_pkey PRIMARY KEY (id);


--
-- Name: world_rules world_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: root
--

ALTER TABLE ONLY public.world_rules
    ADD CONSTRAINT world_rules_pkey PRIMARY KEY (id);


--
-- Name: ix_chapter_versions_chapter_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_chapter_versions_chapter_id ON public.chapter_versions USING btree (chapter_id);


--
-- Name: ix_chapters_project_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_chapters_project_id ON public.chapters USING btree (project_id);


--
-- Name: ix_character_relationships_from_char_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_character_relationships_from_char_id ON public.character_relationships USING btree (from_char_id);


--
-- Name: ix_character_relationships_project_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_character_relationships_project_id ON public.character_relationships USING btree (project_id);


--
-- Name: ix_character_relationships_to_char_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_character_relationships_to_char_id ON public.character_relationships USING btree (to_char_id);


--
-- Name: ix_characters_project_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_characters_project_id ON public.characters USING btree (project_id);


--
-- Name: ix_projects_user_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_projects_user_id ON public.projects USING btree (user_id);


--
-- Name: ix_story_branches_project_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_story_branches_project_id ON public.story_branches USING btree (project_id);


--
-- Name: ix_user_sessions_user_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_user_sessions_user_id ON public.user_sessions USING btree (user_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: root
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: ix_users_username; Type: INDEX; Schema: public; Owner: root
--

CREATE UNIQUE INDEX ix_users_username ON public.users USING btree (username);


--
-- Name: ix_world_modules_project_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_world_modules_project_id ON public.world_modules USING btree (project_id);


--
-- Name: ix_world_rules_project_id; Type: INDEX; Schema: public; Owner: root
--

CREATE INDEX ix_world_rules_project_id ON public.world_rules USING btree (project_id);


--
-- PostgreSQL database dump complete
--

\unrestrict dJvNvEXZ7Jit8eVtbQTVZ6ddfUOqxwjgbKMccbKqIIGebNjYQxn6NfPYpohH2lL

